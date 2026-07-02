"use client";

import { Tabs, TabList, Tab, TabPanels, TabPanel } from "@/components/ui";
import { ZeroDteBoard } from "./ZeroDteBoard";
import { GridBoard } from "@/components/grid/GridBoard";
import { GridSearchBar } from "@/components/grid/GridSearchBar";

/**
 * /grid now leads with the 0DTE Command board (the "what should I trade right now"
 * surface); the classic cross-market Grid stays intact one tab over. The classic
 * tab keeps its own search bar (it was previously in the page header) so the
 * ticker-filter workflow is unchanged. Panels stay unmounted until first visit —
 * the classic Grid's polling/SSE only starts if the user actually opens it.
 */
export function GridPageTabs() {
  return (
    <Tabs defaultValue="command">
      <TabList aria-label="Grid boards" className="max-w-fit">
        <Tab value="command">0DTE Command</Tab>
        <Tab value="classic">Market Grid</Tab>
      </TabList>
      <TabPanels className="mt-4">
        <TabPanel value="command">
          <ZeroDteBoard />
        </TabPanel>
        <TabPanel value="classic">
          <div className="mb-4 flex justify-end">
            <GridSearchBar />
          </div>
          <GridBoard />
        </TabPanel>
      </TabPanels>
    </Tabs>
  );
}
