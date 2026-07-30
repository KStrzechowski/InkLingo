// Build-time configuration, same VITE_* convention as frontend/ — see
// .env.example and README.md. Baked in by Vite, so switching between the
// local backend and the deployed API is a rebuild, not a runtime setting.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
export const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN
export const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID
