import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { AuthSessionMissingError, isAuthSessionMissingError } from "@supabase/supabase-js";

const source = await readFile(new URL("../src/routes/[.]lovable.oauth.consent.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function routeFor({ session = {}, details = null, error = null, sessionError = null } = {}) {
  const exports = {};
  const deps = {
    "@tanstack/react-router": { createFileRoute: () => (route) => route, redirect: (value) => ({ redirect: value }) },
    "@supabase/supabase-js": { isAuthSessionMissingError },
    react: {},
    "react/jsx-runtime": {},
    "@/integrations/supabase/client": { supabase: { auth: {
      getSession: async () => ({ data: { session }, error: sessionError }),
      oauth: { getAuthorizationDetails: async () => ({ data: details, error }) },
    } } },
  };
  vm.runInNewContext(compiled, { exports, URLSearchParams, require: (id) => {
    if (!(id in deps)) throw new Error(`Unexpected dependency: ${id}`);
    return deps[id];
  } });
  return exports.Route;
}

const location = { pathname: "/.lovable/oauth/consent", search: "?authorization_id=test-request", searchStr: "?authorization_id=test-request" };
const preservesConsent = (error) => {
  assert.equal(error.redirect.to, "/auth");
  assert.equal(error.redirect.search.reauth, "oauth");
  assert.equal(error.redirect.search.redirect, location.pathname + location.searchStr);
  return true;
};

test("locally signed-in but server-rejected session returns to explicit sign-in", async () => {
  const route = routeFor({ error: new AuthSessionMissingError() });
  await route.beforeLoad({ search: { authorization_id: "test-request" }, location });
  await assert.rejects(route.loader({ location }), preservesConsent);
});
test("missing local session preserves the original OAuth request", async () => {
  await assert.rejects(routeFor({ session: null }).beforeLoad({ search: { authorization_id: "test-request" }, location }), preservesConsent);
});
test("valid consent details still load normally", async () => {
  const details = { client: { name: "Review client" }, scope: "openid email" };
  assert.equal(await routeFor({ details }).loader({ location }), details);
});
test("expired request and server errors are not misclassified as a login problem", async () => {
  const failure = new Error("authorization request expired");
  await assert.rejects(routeFor({ error: failure }).loader({ location }), (error) => error === failure);
});
