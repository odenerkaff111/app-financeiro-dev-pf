"use client";

import {
  FinancialAssistant,
} from "@/components/assistant/FinancialAssistant";

export default function AssistentePage() {
  return (
    <div className="h-[calc(100dvh-8rem)] min-h-[560px] overflow-hidden">
      <FinancialAssistant />
    </div>
  );
}
