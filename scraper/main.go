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
	"scraper/parsers"
	"sort"
	"strconv"
	"strings"
	"time"

	fhttp "github.com/bogdanfinn/fhttp"
	tls_client "github.com/bogdanfinn/tls-client"
)

var (
	acceptLanguageByTag = map[string]string{
		"de": "de-DE,de;q=0.9,en;q=0.8",
		"fr": "fr-FR,fr;q=0.9,en;q=0.8",
		"ru": "ru-RU,ru;q=0.9,en;q=0.8",
	}
	backends = map[string]parsers.EngineSpec{
		"google":     newGoogleSpec(),
		"duckduckgo": newDuckDuckGoSpec(),
		"yandex":     newYandexSpec(),
	}
)

func pickIdentity(name string) (parsers.BrowserIdentity, error) {
	if name == "" {
		return parsers.Identities[rand.Intn(len(parsers.Identities))], nil
	}
	for _, identity := range parsers.Identities {
		if identity.Name == name {
			return identity, nil
		}
	}
	return parsers.BrowserIdentity{}, errors.New("unsupported profile")
}

func newSession(proxyURL, identityName string) (*parsers.Session, error) {
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

	s := &parsers.Session{
		Client:   client,
		Identity: identity,
	}

	slog.Info("search session created",
		"profile", identity.Name,
		"proxy", proxyURL != "",
	)

	return s, nil
}

func normalizeReq(in *parsers.SearchRequest) {
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

func defaultHeaders(req parsers.SearchRequest, session *parsers.Session) fhttp.Header {
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

func makeHeaders(req parsers.SearchRequest, session *parsers.Session, extra map[string]string, order ...string) fhttp.Header {
	h := defaultHeaders(req, session)
	for key, value := range extra {
		h.Set(key, value)
	}
	return withHeaderOrder(h, order...)
}

func newGoogleSpec() parsers.EngineSpec {
	return parsers.EngineSpec{
		Name:      "google",
		SearchURL: "https://www.google.com/search",
		BuildParams: func(req parsers.SearchRequest) url.Values {
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
		MakeHeaders: func(req parsers.SearchRequest, session *parsers.Session) fhttp.Header {
			return makeHeaders(req, session, map[string]string{
				"referer": "https://www.google.com/",
			}, "referer")
		},
		Parser: parsers.GoogleResults,
	}
}

func newDuckDuckGoSpec() parsers.EngineSpec {
	return parsers.EngineSpec{
		Name:      "duckduckgo",
		SearchURL: "https://html.duckduckgo.com/html/",
		Post:      true,
		BuildParams: func(req parsers.SearchRequest) url.Values {
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
		MakeHeaders: func(req parsers.SearchRequest, session *parsers.Session) fhttp.Header {
			return makeHeaders(req, session, map[string]string{
				"content-type": "application/x-www-form-urlencoded",
				"origin":       "https://html.duckduckgo.com",
				"referer":      "https://html.duckduckgo.com/",
			}, "origin", "referer", "content-type")
		},
		Parser: parsers.DuckDuckGoResults,
	}
}

func newYandexSpec() parsers.EngineSpec {
	return parsers.EngineSpec{
		Name:      "yandex",
		SearchURL: "https://yandex.com/search/site/",
		BuildParams: func(req parsers.SearchRequest) url.Values {
			v := url.Values{}
			v.Set("text", req.Query)
			v.Set("web", "1")
			v.Set("searchid", strconv.Itoa(1000000+rand.Intn(9000000)))

			if req.Page > 1 {
				v.Set("p", strconv.Itoa(req.Page-1))
			}

			return v
		},
		MakeHeaders: func(req parsers.SearchRequest, session *parsers.Session) fhttp.Header {
			return makeHeaders(req, session, map[string]string{
				"referer": "https://yandex.com/",
			}, "referer")
		},
		Parser: parsers.YandexResults,
	}
}

func getBackendSpecs(name string) []parsers.EngineSpec {
	if name == "" || name == "auto" {
		name = "google,duckduckgo,yandex"
	}

	var out []parsers.EngineSpec
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

func fetchBackend(session *parsers.Session, reqIn parsers.SearchRequest, spec parsers.EngineSpec) ([]parsers.TextResult, error) {
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
			"body_preview", parsers.PreviewText(string(body), 600),
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

	return spec.Parser(respBody)
}

func searchText(session *parsers.Session, req parsers.SearchRequest) ([]parsers.TextResult, error) {
	specs := getBackendSpecs(req.Backend)
	if len(specs) == 0 {
		return nil, errors.New("no valid backends")
	}

	merged := make([]parsers.TextResult, 0, 32)
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

func rankResults(items []parsers.TextResult, maxResults int) []parsers.TextResult {
	type aggregate struct {
		item  parsers.TextResult
		count int
	}

	byURL := map[string]*aggregate{}
	ordered := make([]*aggregate, 0, len(items))

	for _, item := range items {
		key := parsers.NormalizeURLKey(item.Href)
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

	out := make([]parsers.TextResult, 0, len(ordered))
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

func searchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req parsers.SearchRequest
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

	resp := parsers.SearchResponse{
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
