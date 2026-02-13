// Stremio addon protocol types
// See: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md

// --- Addon Manifest ---

export interface AddonManifest {
  id: string;
  version: string;
  name: string;
  description: string;
  logo?: string;
  background?: string;
  types: string[];
  catalogs: CatalogDescriptor[];
  resources: ResourceDescriptor[];
  idPrefixes?: string[];
  behaviorHints?: AddonBehaviorHints;
}

export interface CatalogDescriptor {
  type: string;
  id: string;
  name?: string;
  extra?: CatalogExtra[];
}

export interface CatalogExtra {
  name: string;
  isRequired?: boolean;
  options?: string[];
  optionsLimit?: number;
}

export type ResourceDescriptor = string | ResourceDescriptorFull;

export interface ResourceDescriptorFull {
  name: string;
  types: string[];
  idPrefixes?: string[];
}

export interface AddonBehaviorHints {
  adult?: boolean;
  p2p?: boolean;
  configurable?: boolean;
  configurationRequired?: boolean;
}

// --- Meta / Catalog ---

export interface MetaItem {
  id: string;
  type: string;
  name: string;
  poster?: string;
  background?: string;
  description?: string;
  releaseInfo?: string;
  runtime?: string;
  genres?: string[];
  director?: string[];
  cast?: string[];
  imdbRating?: string;
  posterShape?: 'square' | 'poster' | 'landscape';
  videos?: Video[];
  links?: MetaLink[];
  logo?: string;
  year?: number;
}

export interface Video {
  id: string;
  title: string;
  season?: number;
  episode?: number;
  released?: string;
  thumbnail?: string;
  overview?: string;
}

export interface MetaLink {
  name: string;
  category: string;
  url: string;
}

// --- Streams ---

export interface StreamObject {
  url?: string;
  ytId?: string;
  infoHash?: string;
  fileIdx?: number;
  externalUrl?: string;
  name?: string;
  title?: string;
  behaviorHints?: StreamBehaviorHints;
}

export interface StreamBehaviorHints {
  notWebReady?: boolean;
  bingeGroup?: string;
  proxyHeaders?: {
    request?: Record<string, string>;
    response?: Record<string, string>;
  };
}

// --- Subtitles ---

export interface SubtitleObject {
  id: string;
  url: string;
  lang: string;
}

// --- API Responses ---

export interface CatalogResponse {
  metas: MetaItem[];
}

export interface MetaResponse {
  meta: MetaItem;
}

export interface StreamResponse {
  streams: StreamObject[];
}

export interface SubtitleResponse {
  subtitles: SubtitleObject[];
}

// --- Installed Addon ---

export interface InstalledAddon {
  base_url: string;
  manifest: AddonManifest;
  enabled: boolean;
}

export interface StreamWithAddon {
  addon_name: string;
  addon_id: string;
  stream: StreamObject;
}

// --- Debrid Types ---

export interface ResolvedStream {
  url: string;
  filename?: string;
  filesize?: number;
  mime_type?: string;
  is_streamable?: boolean;
  quality?: string;
  provider: string;
}

export interface CacheCheckResult {
  info_hash: string;
  is_cached: boolean;
  files: CachedFile[];
}

export interface CachedFile {
  id: number;
  filename: string;
  filesize: number;
}

export interface DebridStatus {
  configured: boolean;
  provider_type?: string;
}

// --- IPTV Types ---

export interface IptvChannel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  country?: string;
  language?: string;
  tvg_id?: string;
  tvg_name?: string;
}

export interface IptvPlaylist {
  id: string;
  name: string;
  url?: string;
  channels: IptvChannel[];
  groups: string[];
  last_updated?: string;
}

export interface IptvPlaylistSummary {
  id: string;
  name: string;
  channel_count: number;
  group_count: number;
  url?: string;
  last_updated?: string;
}
