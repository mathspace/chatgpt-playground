package main

import (
	"embed"
	"flag"
	"log"
	"net/http"
)

var (
	listen = flag.String("listen", ":8080", "listen address")

	//go:embed static
	static embed.FS

	//go:embed static/index.html
	indexHTML []byte
)

func handleRequest(w http.ResponseWriter, r *http.Request) {
	w.Header().Add("Content-Type", "text/html; charset=utf-8")
	w.Write(indexHTML)
}

func run() error {
	http.HandleFunc("/", handleRequest)
	http.Handle("/static/", http.FileServer(http.FS(static)))
	return http.ListenAndServe(*listen, nil)
}

func main() {
	log.SetFlags(0)
	if err := run(); err != nil {
		log.Fatalf("chatgpt-playground: %s", err)
	}
}
