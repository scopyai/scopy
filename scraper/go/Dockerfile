FROM golang:1.24.4-alpine AS build

WORKDIR /src

COPY scraper/go.mod scraper/go.sum ./
RUN go mod download

COPY scraper/. ./

RUN go build -o /out/scraper ./main.go

FROM alpine:3.22

WORKDIR /app

COPY --from=build /out/scraper ./scraper

EXPOSE 8080

CMD ["./scraper"]
