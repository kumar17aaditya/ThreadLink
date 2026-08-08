import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./aliasResolver.mjs", pathToFileURL(import.meta.dirname + "/"));
