"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

/** A page can add a last crumb to the top bar (the name of the table it shows, say). */
type Crumbs = {
  /** The name of the current page, shown after the section. */
  title: string | null;
  setTitle: (title: string | null) => void;
};

const BreadcrumbContext = createContext<Crumbs | null>(null);

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const value = useMemo(() => ({ title, setTitle }), [title]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/** The title a page put in the top bar, or null. Read by the shell. */
export function useCrumbTitle(): string | null {
  return useContext(BreadcrumbContext)?.title ?? null;
}

/** Puts `title` in the top bar while the page is shown. Does nothing outside the shell. */
export function usePageCrumb(title: string | null): void {
  const setTitle = useContext(BreadcrumbContext)?.setTitle;
  useEffect(() => {
    if (!setTitle) return;
    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);
}
