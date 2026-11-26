/**
 * "Refresh from Stitch Fiddle" on an imported chart's pattern page: fetches
 * the chart again from the same share link (POST /api/stitch-fiddle/
 * patterns/<id>/refresh) and hands the updated pattern back. Only the
 * chart's grid and colours change; the title and materials stay as edited
 * here. Shown to anyone who can edit the pattern (see PatternDetailPage).
 * The fetch opens Stitch Fiddle on the server, so it can take a while.
 */
import { useState } from "react";
import { Alert, Button, Spinner } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { refreshStitchFiddleChart } from "../api/client";
import { useApiErrorMessage } from "../i18n/useApiErrorMessage";
import type { Pattern } from "../types/models";

interface Props {
  patternId: number;
  onRefreshed: (pattern: Pattern) => void;
}

export default function ChartRefreshButton({ patternId, onRefreshed }: Props) {
  const { t } = useTranslation();
  const getErrorMessage = useApiErrorMessage();
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    setResult(null);
    try {
      const response = await refreshStitchFiddleChart(patternId);
      onRefreshed(response.pattern);
      setResult({ ok: true, text: t(response.changed ? "chartRefresh.updated" : "chartRefresh.upToDate") });
    } catch (err) {
      setResult({ ok: false, text: getErrorMessage(err, t("chartRefresh.failed")) });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mb-2">
      <Button variant="outline-secondary" size="sm" disabled={refreshing} onClick={handleRefresh}>
        {refreshing && <Spinner animation="border" size="sm" className="me-2" aria-hidden="true" />}
        {refreshing ? t("chartRefresh.refreshing") : t("chartRefresh.button")}
      </Button>
      {result && (
        <Alert variant={result.ok ? "success" : "danger"} className="py-2 mt-2 mb-0" role="status">
          {result.text}
        </Alert>
      )}
    </div>
  );
}
