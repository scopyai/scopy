package parsers

import (
	"bytes"
	"log/slog"
	"net/url"
	"strings"

	"github.com/antchfx/htmlquery"
	fhttp "github.com/bogdanfinn/fhttp"
	tls_client "github.com/bogdanfinn/tls-client"
	"github.com/bogdanfinn/tls-client/profiles"
	"golang.org/x/net/html"
)

type BrowserIdentity struct {
	Name    string
	Profile profiles.ClientProfile
	UA      string
}

var Identities = []BrowserIdentity{
	{
		Name:    "chrome_144",
		Profile: profiles.Chrome_144,
		UA:      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
	},
	{
		Name:    "chrome_146",
		Profile: profiles.Chrome_146,
		UA:      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
	},
	{
		Name:    "firefox_117",
		Profile: profiles.Firefox_117,
		UA:      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:117.0) Gecko/20100101 Firefox/117.0",
	},
	{
		Name:    "safari_16_0",
		Profile: profiles.Safari_16_0,
		UA:      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
	},
	{
		Name:    "safari_ios_18_0",
		Profile: profiles.Safari_IOS_18_0,
		UA:      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
	},
}

type SearchRequest struct {
	Backend    string `json:"backend,omitempty"` // auto | google | duckduckgo | yandex | google,duckduckgo
	Query      string `json:"query"`
	Profile    string `json:"profile,omitempty"` // one of the identity names above
	ProxyURL   string `json:"proxyUrl,omitempty"`
	Region     string `json:"region,omitempty"`     // ex: us-en, uk-en, ru-ru
	SafeSearch string `json:"safesearch,omitempty"` // on | moderate | off
	TimeLimit  string `json:"timelimit,omitempty"`  // d | w | m | y
	Page       int    `json:"page,omitempty"`       // 1-based
	MaxResults int    `json:"maxResults,omitempty"`
}

type TextResult struct {
	Title    string `json:"title"`
	Href     string `json:"href"`
	Body     string `json:"body"`
	Engine   string `json:"engine"`
	Provider string `json:"provider"`
	Count    int    `json:"count,omitempty"`
}

type SearchResponse struct {
	Status  int          `json:"status"`
	Results []TextResult `json:"results"`
}

type Session struct {
	Client   tls_client.HttpClient
	Identity BrowserIdentity
}

type EngineSpec struct {
	Name        string
	SearchURL   string
	Post        bool
	BuildParams func(SearchRequest) url.Values
	MakeHeaders func(SearchRequest, *Session) fhttp.Header
	Parser      func([]byte) ([]TextResult, error)
}

type HTMLParserConfig struct {
	ResultsExpr string
	TitleExpr   string
	HrefExpr    string
	BodyExpr    string
	CleanHref   func(string) string
}

func filterQuery(v url.Values) url.Values {
	out := url.Values{}

	for key, vals := range v {
		switch strings.ToLower(key) {
		case "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
			"ved", "ei", "sa", "sei", "gs_lcp", "oq", "aqs", "source", "bih", "biw":
			continue
		default:
			for _, val := range vals {
				out.Add(key, val)
			}
		}
	}

	return out
}

func NormalizeURLKey(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ""
	}

	u.Fragment = ""
	u.RawQuery = filterQuery(u.Query()).Encode()

	host := strings.ToLower(u.Hostname())
	if host == "www.google.com" || host == "google.com" {
		if q := u.Query().Get("q"); q != "" {
			return q
		}
	}

	path := strings.TrimRight(u.EscapedPath(), "/")
	if path == "" {
		path = "/"
	}

	if u.RawQuery == "" {
		return strings.ToLower(host + path)
	}

	return strings.ToLower(host + path + "?" + u.RawQuery)
}

func parseHTMLResults(body []byte, engine string, cfg HTMLParserConfig) ([]TextResult, error) {
	root, err := htmlquery.Parse(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	nodes := htmlquery.Find(root, cfg.ResultsExpr)
	slog.Info("search parse started",
		"engine", engine,
		"html_bytes", len(body),
		"candidate_nodes", len(nodes),
	)

	results := make([]TextResult, 0, len(nodes))
	seen := map[string]struct{}{}

	for _, n := range nodes {
		title := cleanWhitespace(textFromXPath(n, cfg.TitleExpr))
		href := attrFromXPath(n, cfg.HrefExpr, "href")
		if cfg.CleanHref != nil {
			href = cfg.CleanHref(href)
		}
		href = strings.TrimSpace(href)
		if title == "" || href == "" || !isWebURL(href) {
			continue
		}

		key := NormalizeURLKey(href)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}

		bodyText := ""
		if cfg.BodyExpr != "" {
			bodyText = cleanWhitespace(textFromXPath(n, cfg.BodyExpr))
		}
		if bodyText == "" {
			bodyText = snippetText(n, title)
		}

		results = append(results, TextResult{
			Title:    title,
			Href:     href,
			Body:     bodyText,
			Engine:   engine,
			Provider: engine,
		})
	}

	slog.Info("search parse finished",
		"engine", engine,
		"results", len(results),
	)
	if len(results) == 0 {
		slog.Warn("search parse returned no results",
			"engine", engine,
			"candidate_nodes", len(nodes),
			"html_preview", PreviewText(string(body), 600),
		)
	}

	return results, nil
}

func firstNode(n *html.Node, expr string) *html.Node {
	node, err := htmlquery.Query(n, expr)
	if err != nil {
		return nil
	}
	return node
}

func textFromXPath(n *html.Node, expr string) string {
	nodes := htmlquery.Find(n, expr)
	parts := make([]string, 0, len(nodes))

	for _, node := range nodes {
		text := cleanWhitespace(htmlquery.InnerText(node))
		if text != "" {
			parts = append(parts, text)
		}
	}

	return cleanWhitespace(strings.Join(parts, " "))
}

func attrFromXPath(n *html.Node, expr, attr string) string {
	node := firstNode(n, expr)
	if node == nil {
		return ""
	}
	return strings.TrimSpace(htmlquery.SelectAttr(node, attr))
}

func cleanWhitespace(s string) string {
	s = strings.ReplaceAll(s, "\u00a0", " ")
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	return strings.Join(strings.Fields(s), " ")
}

func snippetText(n *html.Node, title string) string {
	text := cleanWhitespace(htmlquery.InnerText(n))
	if text == "" {
		return ""
	}

	if title != "" && strings.HasPrefix(text, title) {
		text = strings.TrimSpace(strings.TrimPrefix(text, title))
	}

	if len(text) > 420 {
		text = text[:420]
	}

	return cleanWhitespace(text)
}

func cleanGoogleHref(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}

	if strings.HasPrefix(raw, "/url?") {
		u, err := url.Parse(raw)
		if err == nil {
			if q := u.Query().Get("q"); q != "" {
				return q
			}
		}
	}

	return raw
}

func isWebURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return u.Scheme == "http" || u.Scheme == "https"
}

func PreviewText(s string, limit int) string {
	s = cleanWhitespace(s)
	if limit > 0 && len(s) > limit {
		return s[:limit]
	}
	return s
}
