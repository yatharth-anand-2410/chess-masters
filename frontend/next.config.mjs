const nextConfig = {
  // Required for the Cloud Run deployment: emit a self-contained server
  // bundle at .next/standalone so the runtime image needs no node_modules.
  output: "standalone",
};

export default nextConfig;