// What the page hands to every widget: the plugin's POST helper and what a widget may do (open an issue, open a session).
// Widgets are rendered into cells gridstack made, but through React portals, so context reaches them from here.
import { createContext, useContext } from 'react';

const ServicesContext = createContext({ request: async () => ({}), openIssue: () => {}, openNativeSession: async () => {}, openIssueSession: async () => {}, previewIssueSession: () => {}, addSession: async () => {}, pickProjectDirectory: undefined });
export const ServicesProvider = ServicesContext.Provider;
export const useServices = () => useContext(ServicesContext);
