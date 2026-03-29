package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"math/rand"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

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

var identities = []BrowserIdentity{
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
	Parser      HTMLParserConfig
}

type HTMLParserConfig struct {
	ResultsExpr string
	TitleExpr   string
	HrefExpr    string
	BodyExpr    string
	CleanHref   func(string) string
}

var (
	acceptLanguageByTag = map[string]string{
		"de": "de-DE,de;q=0.9,en;q=0.8",
		"fr": "fr-FR,fr;q=0.9,en;q=0.8",
		"ru": "ru-RU,ru;q=0.9,en;q=0.8",
	}
	backends = map[string]EngineSpec{
		"google":     newGoogleSpec(),
		"duckduckgo": newDuckDuckGoSpec(),
		"yandex":     newYandexSpec(),
	}
)

func pickIdentity(name string) (BrowserIdentity, error) {
	if name == "" {
		return identities[rand.Intn(len(identities))], nil
	}
	for _, identity := range identities {
		if identity.Name == name {
			return identity, nil
		}
	}
	return BrowserIdentity{}, errors.New("unsupported profile")
}

func newSession(proxyURL, identityName string) (*Session, error) {
	identity, err := pickIdentity(identityName)
	if err != nil {
		return nil, err
	}

	jar := tls_client.NewCookieJar()
	opts := []tls_client.HttpClientOption{
		tls_client.WithTimeoutSeconds(20),
		tls_client.WithClientProfile(identity.Profile),
		tls_client.WithCookieJar(jar),
		tls_client.WithRandomTLSExtensionOrder(),
	}

	if proxyURL != "" {
		opts = append(opts, tls_client.WithProxyUrl(proxyURL))
	}

	client, err := tls_client.NewHttpClient(tls_client.NewNoopLogger(), opts...)
	if err != nil {
		return nil, err
	}

	s := &Session{
		Client:   client,
		Identity: identity,
	}

	slog.Info("search session created",
		"profile", identity.Name,
		"proxy", proxyURL != "",
	)

	return s, nil
}

func normalizeReq(in *SearchRequest) {
	if in.Backend == "" {
		in.Backend = "auto"
	}
	if in.Region == "" {
		in.Region = "us-en"
	}
	if in.SafeSearch == "" {
		in.SafeSearch = "moderate"
	}
	if in.Page <= 0 {
		in.Page = 1
	}
	if in.MaxResults <= 0 {
		in.MaxResults = 10
	}
	in.SafeSearch = strings.ToLower(in.SafeSearch)
	in.TimeLimit = strings.ToLower(in.TimeLimit)
}

func parseRegion(region string) (country string, lang string) {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(region)), "-")
	if len(parts) >= 2 {
		return parts[0], parts[1]
	}
	return "us", "en"
}

func defaultHeaders(req SearchRequest, session *Session) fhttp.Header {
	_, lang := parseRegion(req.Region)
	acceptLang := "en-US,en;q=0.9"
	if value, ok := acceptLanguageByTag[lang]; ok {
		acceptLang = value
	}

	return fhttp.Header{
		"accept":          {"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
		"accept-language": {acceptLang},
		"cache-control":   {"no-cache"},
		"pragma":          {"no-cache"},
		"user-agent":      {session.Identity.UA},
	}
}

func withHeaderOrder(h fhttp.Header, extraOrder ...string) fhttp.Header {
	order := []string{"accept", "accept-language", "cache-control", "pragma", "user-agent"}
	order = append(order, extraOrder...)
	h[fhttp.HeaderOrderKey] = order
	return h
}

func makeHeaders(req SearchRequest, session *Session, extra map[string]string, order ...string) fhttp.Header {
	h := defaultHeaders(req, session)
	for key, value := range extra {
		h.Set(key, value)
	}
	return withHeaderOrder(h, order...)
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

		key := normalizeURLKey(href)
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
			"html_preview", previewText(string(body), 600),
		)
	}

	return results, nil
}

func newGoogleSpec() EngineSpec {
	return EngineSpec{
		Name:      "google",
		SearchURL: "https://www.google.com/search",
		BuildParams: func(req SearchRequest) url.Values {
			country, lang := parseRegion(req.Region)

			v := url.Values{}
			v.Set("q", req.Query)
			v.Set("hl", lang+"-"+strings.ToUpper(country))
			v.Set("lr", "lang_"+lang)
			v.Set("cr", "country"+strings.ToUpper(country))
			v.Set("start", strconv.Itoa((req.Page-1)*10))

			if req.SafeSearch == "off" {
				v.Set("safe", "off")
			} else {
				v.Set("safe", "active")
			}

			if req.TimeLimit != "" {
				v.Set("tbs", "qdr:"+req.TimeLimit)
			}

			return v
		},
		MakeHeaders: func(req SearchRequest, session *Session) fhttp.Header {
			return makeHeaders(req, session, map[string]string{
				"referer": "https://www.google.com/",
			}, "referer")
		},
		Parser: HTMLParserConfig{
			ResultsExpr: `//div[.//h3 and .//a[@href]]`,
			TitleExpr:   `.//h3[1]`,
			HrefExpr:    `.//a[@href][1]`,
			CleanHref:   cleanGoogleHref,
		},
	}
}

func newDuckDuckGoSpec() EngineSpec {
	return EngineSpec{
		Name:      "duckduckgo",
		SearchURL: "https://html.duckduckgo.com/html/",
		Post:      true,
		BuildParams: func(req SearchRequest) url.Values {
			v := url.Values{}
			v.Set("q", req.Query)
			v.Set("kl", req.Region)

			switch req.SafeSearch {
			case "on":
				v.Set("kp", "1")
			default:
				v.Set("kp", "-1")
			}

			if req.Page > 1 {
				v.Set("s", strconv.Itoa(10+(req.Page-2)*15))
			}

			if req.TimeLimit != "" {
				v.Set("df", req.TimeLimit)
			}

			return v
		},
		MakeHeaders: func(req SearchRequest, session *Session) fhttp.Header {
			return makeHeaders(req, session, map[string]string{
				"content-type": "application/x-www-form-urlencoded",
				"origin":       "https://html.duckduckgo.com",
				"referer":      "https://html.duckduckgo.com/",
			}, "origin", "referer", "content-type")
		},
		Parser: HTMLParserConfig{
			ResultsExpr: `//div[contains(@class,'result')]`,
			TitleExpr:   `.//a[contains(@class,'result__a')][1]`,
			HrefExpr:    `.//a[contains(@class,'result__a')][1]`,
			BodyExpr:    `.//*[contains(@class,'result__snippet')]`,
		},
	}
}

func newYandexSpec() EngineSpec {
	return EngineSpec{
		Name:      "yandex",
		SearchURL: "https://yandex.com/search/site/",
		BuildParams: func(req SearchRequest) url.Values {
			v := url.Values{}
			v.Set("text", req.Query)
			v.Set("web", "1")
			v.Set("searchid", strconv.Itoa(1000000+rand.Intn(9000000)))

			if req.Page > 1 {
				v.Set("p", strconv.Itoa(req.Page-1))
			}

			return v
		},
		MakeHeaders: func(req SearchRequest, session *Session) fhttp.Header {
			return makeHeaders(req, session, map[string]string{
				"referer": "https://yandex.com/",
			}, "referer")
		},
		Parser: HTMLParserConfig{
			ResultsExpr: `//li[contains(@class,'serp-item')]`,
			TitleExpr:   `.//h2[1] | .//h3[1]`,
			HrefExpr:    `.//a[@href][1]`,
			BodyExpr:    `.//*[contains(@class,'text-container')] | .//*[contains(@class,'organic__content-wrapper')]`,
		},
	}
}

func getBackendSpecs(name string) []EngineSpec {
	if name == "" || name == "auto" {
		name = "google,duckduckgo,yandex"
	}

	var out []EngineSpec
	seen := map[string]struct{}{}

	for _, part := range strings.Split(name, ",") {
		part = strings.TrimSpace(strings.ToLower(part))
		if _, exists := seen[part]; exists {
			continue
		}
		spec, ok := backends[part]
		if !ok {
			continue
		}
		seen[part] = struct{}{}
		out = append(out, spec)
	}

	names := make([]string, 0, len(out))
	for _, spec := range out {
		names = append(names, spec.Name)
	}
	slog.Info("search backends selected",
		"requested", name,
		"selected", strings.Join(names, ","),
	)

	return out
}

func fetchBackend(session *Session, reqIn SearchRequest, spec EngineSpec) ([]TextResult, error) {
	params := spec.BuildParams(reqIn)
	reqURL := spec.SearchURL
	reqBody := io.Reader(nil)

	if spec.Post {
		reqBody = bytes.NewBufferString(params.Encode())
	} else {
		u, err := url.Parse(spec.SearchURL)
		if err != nil {
			return nil, err
		}
		u.RawQuery = params.Encode()
		reqURL = u.String()
	}

	req, err := fhttp.NewRequest(http.MethodGet, reqURL, reqBody)
	if err != nil {
		return nil, err
	}
	if spec.Post {
		req.Method = http.MethodPost
	}
	req.Header = spec.MakeHeaders(reqIn, session)

	slog.Info("search request sending",
		"engine", spec.Name,
		"method", req.Method,
		"url", reqURL,
		"params", params.Encode(),
		"profile", session.Identity.Name,
	)

	resp, err := session.Client.Do(req)
	if err != nil {
		slog.Error("search request failed",
			"engine", spec.Name,
			"error", err,
		)
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		slog.Warn("search request returned non-200",
			"engine", spec.Name,
			"status", resp.StatusCode,
			"body_preview", previewText(string(body), 600),
		)
		return nil, fmt.Errorf("%s returned status %d: %s", spec.Name, resp.StatusCode, strings.TrimSpace(string(body)))
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		slog.Error("search response read failed",
			"engine", spec.Name,
			"error", err,
		)
		return nil, err
	}
	slog.Info("search response received",
		"engine", spec.Name,
		"status", resp.StatusCode,
		"bytes", len(respBody),
		"content_type", resp.Header.Get("content-type"),
	)

	return parseHTMLResults(respBody, spec.Name, spec.Parser)
}

func searchText(session *Session, req SearchRequest) ([]TextResult, error) {
	specs := getBackendSpecs(req.Backend)
	if len(specs) == 0 {
		return nil, errors.New("no valid backends")
	}

	merged := make([]TextResult, 0, 32)
	var lastErr error
	for _, spec := range specs {
		items, err := fetchBackend(session, req, spec)
		if err != nil {
			slog.Warn("search backend failed",
				"engine", spec.Name,
				"error", err,
			)
			lastErr = err
			continue
		}
		slog.Info("search backend finished",
			"engine", spec.Name,
			"results", len(items),
		)
		merged = append(merged, items...)
	}

	if len(merged) == 0 && lastErr != nil {
		return nil, lastErr
	}

	return rankResults(merged, req.MaxResults), nil
}

func rankResults(items []TextResult, maxResults int) []TextResult {
	type aggregate struct {
		item  TextResult
		count int
	}

	byURL := map[string]*aggregate{}
	ordered := make([]*aggregate, 0, len(items))

	for _, item := range items {
		key := normalizeURLKey(item.Href)
		if key == "" {
			continue
		}

		if existing, ok := byURL[key]; ok {
			existing.count++
			if len(item.Body) > len(existing.item.Body) {
				existing.item.Body = item.Body
			}
			if existing.item.Engine != item.Engine && !strings.Contains(existing.item.Engine, item.Engine) {
				existing.item.Engine += "," + item.Engine
			}
			continue
		}

		clone := item
		agg := &aggregate{item: clone, count: 1}
		byURL[key] = agg
		ordered = append(ordered, agg)
	}

	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].count > ordered[j].count
	})

	out := make([]TextResult, 0, len(ordered))
	for _, agg := range ordered {
		agg.item.Count = agg.count
		out = append(out, agg.item)
	}

	if maxResults > 0 && len(out) > maxResults {
		out = out[:maxResults]
	}

	slog.Info("search ranking finished",
		"input_results", len(items),
		"output_results", len(out),
	)

	return out
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

func normalizeURLKey(raw string) string {
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

func previewText(s string, limit int) string {
	s = cleanWhitespace(s)
	if limit > 0 && len(s) > limit {
		return s[:limit]
	}
	return s
}

func searchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SearchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	normalizeReq(&req)
	if strings.TrimSpace(req.Query) == "" {
		http.Error(w, "query is required", http.StatusBadRequest)
		return
	}

	slog.Info("search request received",
		"query", req.Query,
		"backend", req.Backend,
		"region", req.Region,
		"safesearch", req.SafeSearch,
		"timelimit", req.TimeLimit,
		"page", req.Page,
		"max_results", req.MaxResults,
	)

	session, err := newSession(req.ProxyURL, req.Profile)
	if err != nil {
		if err.Error() == "unsupported profile" {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	results, err := searchText(session, req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	resp := SearchResponse{
		Status:  http.StatusOK,
		Results: results,
	}

	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/search", searchHandler)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	srv := &http.Server{
		Addr:              "127.0.0.1:8080",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Println("listening on http://127.0.0.1:8080")
	log.Fatal(srv.ListenAndServe())
}
