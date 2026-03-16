.PHONY: help setup lint test check generate clean

help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup: ## Install deps
	npm install

lint: ## Lint code with eslint
	npx eslint .

test: ## Run tests
	node --test test/*.test.js

check: lint test ## Run all checks (lint, test)

generate: ## Regenerate API surfaces from operations
	node scripts/generate.js

clean: ## Clean build artifacts
	rm -rf node_modules/ __baselines__/ __captures__/
