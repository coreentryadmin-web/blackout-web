import { test } from "node:test";
import assert from "node:assert/strict";
import { extractExportedComponentNames, isReferencedElsewhere } from "./stage5-proposals";

test("extractExportedComponentNames: finds export function, export default function, and export const forms", () => {
  const content = `
    export function FooPanel() { return null; }
    export default function BarWidget() { return null; }
    export const BazCard = () => null;
    export const nonComponent = 5;
    function NotExported() {}
  `;
  assert.deepEqual(
    extractExportedComponentNames(content).sort(),
    ["BarWidget", "BazCard", "FooPanel"]
  );
});

test("extractExportedComponentNames: empty file yields no components", () => {
  assert.deepEqual(extractExportedComponentNames(""), []);
});

test("isReferencedElsewhere: true when another file mentions the component name", () => {
  const files = [
    { file: "src/components/Foo.tsx", content: "export function Foo() {}" },
    { file: "src/app/page.tsx", content: 'import { Foo } from "@/components/Foo";' },
  ];
  assert.equal(isReferencedElsewhere("Foo", "src/components/Foo.tsx", files), true);
});

test("isReferencedElsewhere: false when the declaration is the ONLY occurrence anywhere", () => {
  const files = [
    { file: "src/components/Orphan.tsx", content: "export function Orphan() { return null; }" },
    { file: "src/app/page.tsx", content: "export default function Home() { return null; }" },
  ];
  assert.equal(isReferencedElsewhere("Orphan", "src/components/Orphan.tsx", files), false);
});

test("isReferencedElsewhere: true when used a second time WITHIN its own defining file (an internal sub-component, not dead)", () => {
  // Regression: a component only ever rendered by its sibling export in the same
  // file (e.g. GexDealerPanel.tsx exporting both GexDealerPanel and a small
  // Flow0dtePanel it renders internally) is real, alive code -- not an orphan,
  // even though nothing imports it from outside the file.
  const files = [
    {
      file: "src/components/desk/Panel.tsx",
      content: "export function SubPanel() { return null; }\nexport function MainPanel() { return <SubPanel />; }",
    },
  ];
  assert.equal(isReferencedElsewhere("SubPanel", "src/components/desk/Panel.tsx", files), true);
});

test("isReferencedElsewhere: a comment mention elsewhere still suppresses the flag (biased toward under-reporting)", () => {
  const files = [
    { file: "src/components/Orphan.tsx", content: "export function Orphan() {}" },
    { file: "src/lib/notes.ts", content: "// TODO: wire up Orphan into the dashboard" },
  ];
  assert.equal(isReferencedElsewhere("Orphan", "src/components/Orphan.tsx", files), true);
});
