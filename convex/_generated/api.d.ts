/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as applications from "../applications.js";
import type * as applications from "../applications.js";
import type * as candidates from "../candidates.js";
import type * as jobs from "../jobs.js";
import type * as lib_application from "../lib/application.js";
import type * as lib_application from "../lib/application.js";
import type * as lib_cv from "../lib/cv.js";
import type * as lib_profiles from "../lib/profiles.js";
import type * as lib_reportTemplate from "../lib/reportTemplate.js";
import type * as lib_schedule from "../lib/schedule.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as lib_sources from "../lib/sources.js";
import type * as migrations from "../migrations.js";
import type * as operations from "../operations.js";
import type * as settings from "../settings.js";
import type * as tracking from "../tracking.js";
import type * as workflows from "../workflows.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  applications: typeof applications;
  applications: typeof applications;
  candidates: typeof candidates;
  jobs: typeof jobs;
  "lib/application": typeof lib_application;
  "lib/application": typeof lib_application;
  "lib/cv": typeof lib_cv;
  "lib/profiles": typeof lib_profiles;
  "lib/reportTemplate": typeof lib_reportTemplate;
  "lib/schedule": typeof lib_schedule;
  "lib/scoring": typeof lib_scoring;
  "lib/sources": typeof lib_sources;
  migrations: typeof migrations;
  operations: typeof operations;
  settings: typeof settings;
  tracking: typeof tracking;
  workflows: typeof workflows;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
