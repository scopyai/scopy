package parsers

func YandexResults(body []byte) ([]TextResult, error) {
	return parseHTMLResults(body, "yandex", HTMLParserConfig{
		ResultsExpr: `//li[contains(@class,'serp-item')]`,
		TitleExpr:   `.//h2[1] | .//h3[1]`,
		HrefExpr:    `.//a[@href][1]`,
		BodyExpr:    `.//*[contains(@class,'text-container')] | .//*[contains(@class,'organic__content-wrapper')]`,
	})
}
