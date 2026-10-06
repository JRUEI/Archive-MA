import type { NextConfig } from "next";

// 在 GitHub Actions 上才輸出成靜態站（GitHub Pages，網址帶 /<repo>/）；本機 dev / build 維持原樣
const onPages = Boolean(process.env.GITHUB_ACTIONS);
const repoName = "Archive-MA";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  ...(onPages && { output: "export", basePath: `/${repoName}`, trailingSlash: true }),
};

export default nextConfig;
