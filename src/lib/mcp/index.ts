import { auth, defineMcp } from "@lovable.dev/mcp-js";
import dashboard from "./tools/dashboard";
import activity from "./tools/activity";
import listTasks from "./tools/list-tasks";
import getTask from "./tools/get-task";
import createTask from "./tools/create-task";
import updateTask from "./tools/update-task";
import { completeTask, reopenTask } from "./tools/complete-task";
import { listTrash, placeTask, reorderTasks, restoreTask, trashTask } from "./tools/trash";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

// Every tool acts as the signed-in portal user; RLS and role checks decide access.
export default defineMcp({
  name: "venusxportal",
  title: "Venusxportal",
  version: "0.1.0",
  instructions:
    "VenusX Portal tools. Read the dashboard and recent activity; list, read, create, edit, complete and reopen tasks; move to Trash, list Trash, restore, and manually reorder tasks. Dates are YYYY-MM-DD in America/Bogota. Completing acts on one dated execution only.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [dashboard, activity, listTasks, getTask, createTask, updateTask, completeTask, reopenTask, trashTask, listTrash, restoreTask, reorderTasks, placeTask],
});
