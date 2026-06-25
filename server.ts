import "dotenv/config";
import app from "./lib/app.js";

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
