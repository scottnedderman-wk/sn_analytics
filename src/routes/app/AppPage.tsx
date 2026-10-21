import { type MouseEvent } from "react";
import { useParams } from "react-router";
import { NotFound } from "@/components/ui";
import type { DashboardData } from "@/lib/model";
import { AppDetail } from "./AppDetail";

export function AppPage({
  data,
  onTip,
}: {
  data: DashboardData;
  onTip: (text: string | null, e?: MouseEvent) => void;
}) {
  const { repo } = useParams();
  const name = repo ?? "";
  const detail = data.repos.find((r) => r.repo === name);
  if (!detail) {
    return <NotFound message={`No application named “${name}” is in this report.`} />;
  }
  return <AppDetail repo={detail} onTip={onTip} />;
}
