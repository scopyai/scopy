package parsers

import (
	"bytes"
	"fmt"
	"log/slog"
	"math/rand"
	"strings"

	"github.com/antchfx/htmlquery"
)

// thanks to deedy5 at https://github.com/deedy5/ddgs
func GoogleResults(body []byte) ([]TextResult, error) {
	root, err := htmlquery.Parse(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	nodes := htmlquery.Find(root, `//div[@data-hveid][.//h3]`)
	slog.Info("search parse started",
		"engine", "google",
		"html_bytes", len(body),
		"candidate_nodes", len(nodes),
	)

	results := make([]TextResult, 0, len(nodes))
	seen := map[string]struct{}{}

	for _, n := range nodes {
		title := cleanWhitespace(textFromXPath(n, `.//h3//text()`))
		href := googleHref(attrFromXPath(n, `.//a[.//h3]`, "href"))
		if title == "" || !strings.HasPrefix(href, "http") {
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

		results = append(results, TextResult{
			Title:    title,
			Href:     href,
			Body:     cleanWhitespace(textFromXPath(n, `./div/div[last()]//text()`)),
			Engine:   "google",
			Provider: "google",
		})
	}

	slog.Info("search parse finished",
		"engine", "google",
		"results", len(results),
	)
	if len(results) == 0 {
		slog.Warn("search parse returned no results",
			"engine", "google",
			"candidate_nodes", len(nodes),
			"html_preview", PreviewText(string(body), 600),
		)
	}

	return results, nil
}

func GoogleAppUserAgent() string {
	devices := []struct {
		android string
		device  string
		min     int
		max     int
	}{
		{android: "5.0", device: "SM-G900P Build/LRX21T", min: 39, max: 60},
		{android: "6.0", device: "Nexus 5 Build/MRA58N", min: 39, max: 60},
		{android: "8.0", device: "Pixel 2 Build/OPD3.170816.012", min: 39, max: 60},
	}

	device := devices[rand.Intn(len(devices))]
	chromeMajor := rand.Intn(device.max-device.min+1) + device.min
	chromeBuild := rand.Intn(9000) + 1000
	chromePatch := rand.Intn(1000) + 1000

	return fmt.Sprintf(
		"Mozilla/5.0 (Linux; Android %s; %s) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/%d.0.%d.%d Mobile Safari/537.36 GoogleApp/%d",
		device.android,
		device.device,
		chromeMajor,
		chromeBuild,
		chromePatch,
		rand.Intn(10),
	)
}

func googleHref(raw string) string {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "/url?q=") {
		return strings.Split(strings.Split(raw, "?q=")[1], "&")[0]
	}
	return raw
}
