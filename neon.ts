// Neon infrastructure as code (spec 0006): the public read bucket for uploaded media.
// Apply with `neon deploy` on the production branch; `neon checkout` provisions it on new branches.
import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  buckets: {
    media: { access: "public_read" },
  },
});
