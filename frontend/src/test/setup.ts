import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import.meta.env.VITE_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "http://127.0.0.1:54321";
import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "test-publishable-key";

afterEach(() => cleanup());
