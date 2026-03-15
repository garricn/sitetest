#!/usr/bin/env node

import { createServer } from "node:http";
import { handleRequest } from "../generated/api-routes.js";

const PORT = parseInt(process.env.SITETEST_PORT || "3200", 10);

const server = createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`sitetest API listening on http://localhost:${PORT}`);
});

process.on("SIGINT", () => process.exit(0));
