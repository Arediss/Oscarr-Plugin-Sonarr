import React, { useEffect, useId, useState } from 'react';
import { LibraryTab } from './components/LibraryTab';
import { AnalyticsTab } from './components/AnalyticsTab';
import { QualityTab } from './components/QualityTab';
import { ReleasesTab } from './components/ReleasesTab';
import { FilesTab } from './components/FilesTab';
import { DownloadsTab } from './components/DownloadsTab';

const TABS = [
  { id: 'library', label: 'Library', Component: LibraryTab },
  { id: 'downloads', label: 'Downloads', Component: DownloadsTab },
  { id: 'analytics', label: 'Analytics', Component: AnalyticsTab },
  { id: 'quality', label: 'Quality', Component: QualityTab },
  { id: 'releases', label: 'Releases', Component: ReleasesTab },
  { id: 'files', label: 'Files', Component: FilesTab },
] as const;

type TabId = (typeof TABS)[number]['id'];

function getInitialTab(): TabId {
  const hash = window.location.hash.slice(1);
  return TABS.find(tab => tab.id === hash)?.id ?? 'library';
}

export default function SonarrManager() {
  const [activeTab, setActiveTab] = useState<TabId>(getInitialTab);
  const id = useId();
  useEffect(() => {
    const sync = () => setActiveTab(getInitialTab());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const select = (tab: TabId) => { setActiveTab(tab); window.location.hash = tab; };
  const ActiveComponent = TABS.find(tab => tab.id === activeTab)!.Component;

  return <div className="arr-manager">
    <header className="arr-manager-header">
      <span className="arr-manager-logo">
        <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="7" width="20" height="15" rx="3" /><path d="m7 2 5 5 5-5" />
        </svg>
      </span>
      <div><h1>Sonarr Manager</h1><p>Your series library, downloads and storage.</p></div>
    </header>
    <div className="arr-tabs" role="tablist" aria-label="Sonarr sections">
      {TABS.map((tab, index) => <button key={tab.id} type="button" role="tab"
        id={id + '-' + tab.id} aria-controls={id + '-panel'} aria-selected={activeTab === tab.id}
        tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => select(tab.id)}
        onKeyDown={event => {
          let next: number;
          if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
          else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = TABS.length - 1;
          else return;
          event.preventDefault();
          select(TABS[next].id);
          document.getElementById(id + '-' + TABS[next].id)?.focus();
        }}>{tab.label}</button>)}
    </div>
    <div id={id + '-panel'} role="tabpanel" aria-labelledby={id + '-' + activeTab} tabIndex={0}>
      <ActiveComponent key={activeTab} />
    </div>
  </div>;
}
