import { createApiClient } from "@splitpea/api-client";
import { API_BASE_URL } from "./config";

// Single shared API client instance for the whole app.
export const api = createApiClient({ baseUrl: API_BASE_URL });
