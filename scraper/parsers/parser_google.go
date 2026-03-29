package parsers

func GoogleResults(body []byte) ([]TextResult, error) {
	return parseHTMLResults(body, "google", HTMLParserConfig{
		ResultsExpr: `//div[.//h3 and .//a[@href]]`,
		TitleExpr:   `.//h3[1]`,
		HrefExpr:    `.//a[@href][1]`,
		CleanHref:   cleanGoogleHref,
	})
}
