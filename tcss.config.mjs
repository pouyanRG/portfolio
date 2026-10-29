warning: in the working copy of 'next.config.ts', LF will be replaced by CRLF the next time Git touches it
[1mdiff --git a/next.config.ts b/next.config.ts[m
[1mindex a0cf0c7..5327f6c 100644[m
[1m--- a/next.config.ts[m
[1m+++ b/next.config.ts[m
[36m@@ -1,17 +1,8 @@[m
[31m-import type { NextConfig } from "next";[m
[32m+[m[32m﻿import type { NextConfig } from "next";[m
 [m
 const nextConfig: NextConfig = {[m
[31m-  /* config options here */[m
   cacheComponents: true,[m
   partialPrefetching: true,[m
[31m-  turbopack: {[m
[31m-    rules: {[m
[31m-      "*.css": {[m
[31m-        loaders: ["@tailwindcss/turbopack"],[m
[31m-        as: "*.css",[m
[31m-      },[m
[31m-    },[m
[31m-  },[m
 };[m
 [m
 export default nextConfig;[m
