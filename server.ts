import "dotenv/config";
// Error reporting starts before the app loads (spec 0036); off without SENTRY_DSN.
import "./lib/monitoring.js";
import app from "./lib/app.js";

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
