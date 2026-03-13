export type ArchiveState =
  | 'queued'
  | 'crawling'
  | 'downloading'
  | 'packaging'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused';

export interface ArchiveOptions {
  url: string;
  maxDepth: number;
  maxPages: number;
  includeAssets: boolean;
  requestDelayMs: number;
  singlePage?: boolean;
  userAgent?: string;
  customHeaders?: Record<string, string>;
  excludePatterns?: string[];
}

export interface ArchiveTask {
  id: string;
  url: string;
  title: string | null;
  state: ArchiveState;
  pagesFound: number;
  pagesDownloaded: number;
  assetsDownloaded: number;
  totalBytes: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  cid: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  options: ArchiveOptions;
}

export interface ArchivedSite {
  cid: string;
  url: string;
  title: string | null;
  pagesCount: number;
  assetsCount: number;
  totalBytes: number;
  archivedAt: string;
}

export interface ArchiveQueueState {
  tasks: ArchiveTask[];
  activeCount: number;
  queuedCount: number;
  completedCount: number;
  pausedCount: number;
  maxConcurrent: number;
  archivedSites: ArchivedSite[];
}
