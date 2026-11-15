import { QueryClient } from "@tanstack/react-query";

// One client for the app, so signing out can drop every cached response
// (the next person on this browser must never see the previous one's data).
export const queryClient = new QueryClient();
