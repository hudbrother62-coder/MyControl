"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { campaignRequest } from "@/lib/campaigns";
export function useCampaignData(query = "") {
  const generation = useRef(0);
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    try {
      const result = await campaignRequest(undefined, query);
      if (version === generation.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (version === generation.current)
        setError(e instanceof Error ? e.message : "Gagal memuat");
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, [query]);
  useEffect(() => {
    let active = true;
    const run = () => {
      if (active) void refresh();
    };
    run();
    const id = setInterval(run, 15000);
    return () => {
      active = false;
      generation.current++;
      clearInterval(id);
    };
  }, [refresh]);
  return { data, error, loading, refresh };
}
