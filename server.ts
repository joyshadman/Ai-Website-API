import "dotenv/config";
import app from "./lib/app.js";

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
