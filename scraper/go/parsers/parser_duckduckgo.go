package parsers

func DuckDuckGoResults(body []byte) ([]TextResult, error) {
	return parseHTMLResults(body, "duckduckgo", HTMLParserConfig{
		ResultsExpr: `//div[contains(@class,'result')]`,
		TitleExpr:   `.//a[contains(@class,'result__a')][1]`,
		HrefExpr:    `.//a[contains(@class,'result__a')][1]`,
		BodyExpr:    `.//*[contains(@class,'result__snippet')]`,
	})
}
