//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen -generate types,chi-server -package api -o zz_generated.go ../../openapi.yaml

// Package api chứa code sinh từ openapi.yaml (spec-first). ServerInterface do
// oapi-codegen sinh cưỡng chế handler khớp hợp đồng lúc compile.
package api
