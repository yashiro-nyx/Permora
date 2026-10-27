import assert from "node:assert/strict";
import test from "node:test";
import { maintenanceMode, maintenanceActive } from "../lib/maintenance";

test("maintenanceMode parses explicit values", () => {
  assert.equal(maintenanceMode(undefined), "off");
  assert.equal(maintenanceMode(""), "off");
  assert.equal(maintenanceMode("  "), "off");
  for (const v of ["1", "true", "on", "yes", "ON", " True "])
    assert.equal(maintenanceMode(v), "on", v);
  for (const v of ["0", "false", "off", "no", "OFF"])
    assert.equal(maintenanceMode(v), "off", v);
  for (const v of ["maybe", "2", "enabled!", "x"])
    assert.equal(maintenanceMode(v), "invalid", v);
});

test("maintenanceActive is fail-closed: invalid blocks", () => {
  assert.equal(maintenanceActive("on"), true);
  assert.equal(maintenanceActive("off"), false);
  assert.equal(maintenanceActive("invalid"), true); // fail closed
});
