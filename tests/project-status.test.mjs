import assert from "node:assert/strict";
import test from "node:test";
import { assignProjectCalendarLanes, getEmployeeAvailability, getProjectStatus, getVehicleAvailability, isValidProjectDateRange } from "../src/lib/project-utils.ts";

const project = (status, endDate) => ({ status, endDate });

test("a planned project remains planned through its final scheduled day", () => {
  assert.equal(getProjectStatus(project("PLANNED", "2026-10-30"), "2026-10-30"), "PLANNED");
});

test("a planned project is completed starting the day after its end date", () => {
  assert.equal(getProjectStatus(project("PLANNED", "2026-10-30"), "2026-10-31"), "COMPLETED");
});

test("a new project does not become completed before it is planned", () => {
  assert.equal(getProjectStatus(project("NEW", "2026-10-29"), "2026-10-31"), "NEW");
});

test("new legacy projects without a desired end date remain new", () => {
  assert.equal(getProjectStatus(project("NEW", null), "2026-10-31"), "NEW");
});

test("a desired period requires both dates and a non-reversed range", () => {
  assert.equal(isValidProjectDateRange("2026-10-30", "2026-10-30"), true);
  assert.equal(isValidProjectDateRange("2026-10-30", "2026-10-31"), true);
  assert.equal(isValidProjectDateRange("2026-10-31", "2026-10-30"), false);
  assert.equal(isValidProjectDateRange("", "2026-10-31"), false);
});

test("completed project assignments remain visible in historical employee availability checks", () => {
  const completed = { id: "p1", status: "COMPLETED", startDate: "2026-10-01", endDate: "2026-10-05", archivedAt: null };
  const data = { projects: [completed], assignments: [{ projectId: "p1", employeeId: "e1" }] };
  assert.deepEqual(getEmployeeAvailability(data, { id: "e1" }, "2026-10-03", "2026-10-03"), [completed]);
});

test("completed project vehicles remain visible in historical availability checks", () => {
  const completed = { id: "p1", status: "COMPLETED", startDate: "2026-10-01", endDate: "2026-10-05", vehicleId: "IVECO", archivedAt: null };
  const data = { projects: [completed] };
  assert.deepEqual(getVehicleAvailability(data, "IVECO", "2026-10-03", "2026-10-03"), [completed]);
});

test("calendar lanes keep a multi-week project on one row without overlapping events", () => {
  const projects = [
    { id: "long", startDate: "2026-10-01", endDate: "2026-10-14" },
    { id: "overlap", startDate: "2026-10-05", endDate: "2026-10-08" },
    { id: "later", startDate: "2026-10-15", endDate: "2026-10-17" },
  ];
  const lanes = assignProjectCalendarLanes(projects);
  assert.equal(lanes.find(({ project }) => project.id === "long").lane, 0);
  assert.equal(lanes.find(({ project }) => project.id === "overlap").lane, 1);
  assert.equal(lanes.find(({ project }) => project.id === "later").lane, 0);
});
