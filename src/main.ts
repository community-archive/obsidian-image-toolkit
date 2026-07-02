import { Plugin, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, ImageToolkitSettingTab } from './conf/settings'
import {DEFAULT_VIEW_MODE, MOVE_THE_IMAGE, SWITCH_THE_IMAGE, VIEW_DIAGRAM_SELECTOR, VIEW_IMG_SELECTOR, ViewMode} from './conf/constants'
import { NormalContainerView } from './ui/container/normalContainer.view';
import { PinContainerView } from './ui/container/pinContainer.view';
import { ContainerView } from "./ui/container/container.view";
import { SettingsIto } from "./model/settings.to";
import { ContainerFactory } from "./factory/containerFactory";
import { randomUUID } from "crypto";
import {DiagramUtil} from "./util/diagramUtil";

export default class ImageToolkitPlugin extends Plugin {

  public settings: SettingsIto;

  private readonly containerFactory = new ContainerFactory();

  // auxiliary Pin-mode containers used by the "pin this image" toolbar action in Normal mode;
  // kept independent of `settings.viewMode` so the global mode is never switched by this action.
  // key: '' for the main window, otherwise the popout window's event id
  private readonly pinModeContainers: Map<string, PinContainerView> = new Map();

  public imgSelector: string = ``;
  public diagramSelector: string = ``;

  private static readonly IMG_ORIGIN_CURSOR = 'data-oit-origin-cursor';
  private static readonly EDITOR_IMAGE_LAYOUT_CLASS = 'oit-editor-image-layout';
  private static readonly EDITOR_IMAGE_MAX_HEIGHT_VAR = '--oit-editor-image-max-height';

  // data-oit-event: 标识new window是否已addEventListener for click
  private static readonly POPOUT_WINDOW_EVENT = 'data-oit-event';


  async onload() {
    console.log('loading %s plugin v%s ...', this.manifest.id, this.manifest.version);

    await this.loadSettings();

    this.addSettingTab(new ImageToolkitSettingTab(this.app, this));

    // this.registerCommands();

    await this.initContainer(this.settings.viewMode);

    this.refreshEditorImageLayout();
    this.refreshViewTrigger();

    // addEventListener for opened new windows
    this.app.workspace.on('layout-change', () => {
      this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
        if (['markdown', 'image'].includes(leaf.getViewState()?.type)) {
          const bodyEl = leaf.view.containerEl.matchParent('body');
          if (bodyEl?.hasClass('is-popout-window')) {
            if (!bodyEl.hasAttribute(ImageToolkitPlugin.POPOUT_WINDOW_EVENT)) {
              console.log('popout leaf:', leaf, leaf.getDisplayText());
              const eventId = randomUUID();
              this.initContainer(this.settings.viewMode, eventId);
              bodyEl.setAttr(ImageToolkitPlugin.POPOUT_WINDOW_EVENT, eventId);
              this.refreshEditorImageLayout(bodyEl.ownerDocument);
              this.refreshViewTrigger(bodyEl.ownerDocument);
            }
          }
        }
      }
      )
    });
  }

  onunload() {
    console.log('unloading ' + this.manifest.id + ' plugin...');
    this.getAllContainerViews().forEach(container => {
      container.removeOitContainerView();
    });
    this.pinModeContainers.forEach(container => container.removeOitContainerView());
    this.pinModeContainers.clear();
    this.clearEditorImageLayoutInAllDocuments();
    this.containerFactory.clearAll();
    if (this.imgSelector) {
      document.off('click', this.imgSelector, this.clickImage);
      document.off('mouseover', this.imgSelector, this.mouseoverImg);
      document.off('mouseout', this.imgSelector, this.mouseoutImg);
    }
    if (this.diagramSelector) {
      document.removeEventListener('click', this.clickDiagram, true);
      document.off('mouseover', this.diagramSelector, this.mouseoverDiagram);
      document.off('mouseout', this.diagramSelector, this.mouseoutDiagram);
    }
  }

  private async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    await this.checkViewMode(this.getViewMode());
  }

  public async saveSettings() {
    await this.saveData(this.settings);
  }

  async registerCommands() {
    /* this.addCommand({
        "id": "oit-move-up-image",
        "name": "move up the image",
        hotkeys: [{ modifiers: ["Ctrl"], key: "ArrowUp" }],
        checkCallback: (checking: boolean) => {
            if (checking) return false;
            this.containerView.moveImgViewByHotkey('UP');
        },
    }); */
  }

  public getViewMode = (): ViewMode => {
    return this.settings.viewMode;
  }
  public setViewMode = (viewMode: ViewMode) => {
    return this.settings.viewMode = viewMode;
  }

  private checkViewMode = async (viewMode: ViewMode) => {
    for (const key in ViewMode) {
      if (key == viewMode) {
        return;
      }
    }
    this.setViewMode(DEFAULT_VIEW_MODE)
    console.log('[oit] Reset view mode: %s', DEFAULT_VIEW_MODE);
    await this.saveSettings();
  }

  public getAllContainerViews = (): ContainerView[] => {
    return this.containerFactory.getAllContainers();
  }

  public refreshEditorImageLayout = (doc?: Document) => {
    if (doc) {
      this.updateEditorImageLayout(doc);
      return;
    }
    this.updateEditorImageLayoutInAllDocuments();
  }

  private updateEditorImageLayoutInAllDocuments = () => {
    this.updateEditorImageLayout(document);
    this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      const ownerDocument = leaf.view.containerEl.ownerDocument;
      if (ownerDocument && ownerDocument !== document) {
        this.updateEditorImageLayout(ownerDocument);
      }
    });
  }

  private clearEditorImageLayoutInAllDocuments = () => {
    this.clearEditorImageLayout(document);
    this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      const ownerDocument = leaf.view.containerEl.ownerDocument;
      if (ownerDocument && ownerDocument !== document) {
        this.clearEditorImageLayout(ownerDocument);
      }
    });
  }

  private updateEditorImageLayout = (doc: Document) => {
    const maxHeight = this.normalizeThumbnailMaxHeight(this.settings.thumbnailMaxHeight);
    doc?.body?.classList.add(ImageToolkitPlugin.EDITOR_IMAGE_LAYOUT_CLASS);
    doc?.body?.style.setProperty(ImageToolkitPlugin.EDITOR_IMAGE_MAX_HEIGHT_VAR, `${maxHeight}px`);
  }

  private clearEditorImageLayout = (doc: Document) => {
    doc?.body?.classList.remove(ImageToolkitPlugin.EDITOR_IMAGE_LAYOUT_CLASS);
    doc?.body?.style.removeProperty(ImageToolkitPlugin.EDITOR_IMAGE_MAX_HEIGHT_VAR);
  }

  private normalizeThumbnailMaxHeight = (value: number): number => {
    if (!Number.isFinite(value)) {
      return DEFAULT_SETTINGS.thumbnailMaxHeight;
    }
    return Math.max(50, Math.min(1000, Math.floor(value)));
  }

  private initContainer = async (viewMode: ViewMode, popoutWindowEventId?: string) => {
    const container = await this.initContainerByViewMode(viewMode);
    if (!container) {
      console.error('[oit] Cannot init container');
      return;
    }
    if (popoutWindowEventId) {
      // popoutWindowEventId will be recorded into data-oit-event'of body tag
      this.containerFactory.setPopoutContainer(popoutWindowEventId, container);
    } else {
      this.containerFactory.setMainContainer(container);
    }
  }

  private initContainerByViewMode = async (viewMode: ViewMode, fromDefault?: boolean): Promise<ContainerView> => {
    switch (viewMode) {
      case ViewMode.Normal:
        return new NormalContainerView(this);
      case ViewMode.Pin:
        return new PinContainerView(this);
      default:
        if (fromDefault) {
          return null;
        }
        this.setViewMode(viewMode = DEFAULT_VIEW_MODE);
        await this.saveSettings();
        console.log('[oit] Reset view mode to: %s', viewMode);
        return this.initContainerByViewMode(viewMode, true);
    }
  }

  private isImageElement = (imgEl: HTMLImageElement): boolean => {
    return imgEl && 'IMG' === imgEl.tagName;
  }

  private isClickable = (targetEl: HTMLImageElement, event: MouseEvent): ContainerView => {
    let container: ContainerView;
    if (this.isImageElement(targetEl)
      && !this.isInsideDiagram(targetEl)
      && (container = this.containerFactory.getContainer(targetEl))
      && container.checkHotkeySettings(event, this.settings.viewTriggerHotkey)) {
      return container;
    }
    return null;
  }

  private isClickableDiagram = (targetEl: HTMLElement, event: MouseEvent): ContainerView => {
    let container: ContainerView;
    if (targetEl
      && (container = this.containerFactory.getContainer(targetEl))
      && container.checkHotkeySettings(event, this.settings.viewTriggerHotkey)) {
      return container;
    }
    return null;
  }

  /**
   * Get (or lazily create) the auxiliary Pin-mode container for the window that `targetEl` belongs to.
   * Used only by the "pin this image" toolbar action in Normal mode; does not touch `settings.viewMode`.
   * @param targetEl
   */
  public getPinModeContainer = (targetEl: HTMLElement): PinContainerView => {
    const bodyEl = targetEl?.matchParent('body');
    const key = bodyEl?.getAttribute(ImageToolkitPlugin.POPOUT_WINDOW_EVENT) || '';
    let pinContainer = this.pinModeContainers.get(key);
    if (!pinContainer) {
      pinContainer = new PinContainerView(this);
      this.pinModeContainers.set(key, pinContainer);
    }
    return pinContainer;
  }

  public switchViewMode = async (viewMode: ViewMode) => {
    this.settings.viewMode = viewMode;
    await this.saveSettings();
    this.getAllContainerViews().forEach(container => {
      container.removeOitContainerView();
      this.initContainer(viewMode, container.getParentContainerEl()?.getAttribute('data-oit-event'));
    });
  }

  /**
   * refresh events for main container
   */
  public refreshViewTrigger = (doc?: Document) => {
    // .workspace-leaf-content[data-type='markdown'] img,.workspace-leaf-content[data-type='image'] img
    const viewImageInEditor = this.settings.viewImageInEditor;
    // .community-modal-details img
    const viewImageInCPB = this.settings.viewImageInCPB;
    // false: ... img:not(a img)
    const viewImageWithLink = this.settings.viewImageWithLink;
    // #sr-flashcard-view img
    const viewImageOther = this.settings.viewImageOther;

    if (!doc) {
      doc = document;
    }
    if (this.imgSelector) {
      doc.off('click', this.imgSelector, this.clickImage);
      doc.off('mouseover', this.imgSelector, this.mouseoverImg);
      doc.off('mouseout', this.imgSelector, this.mouseoutImg);
      this.imgSelector = '';
    }
    if (this.diagramSelector) {
      doc.removeEventListener('click', this.clickDiagram, true);
      doc.off('mouseover', this.diagramSelector, this.mouseoverDiagram);
      doc.off('mouseout', this.diagramSelector, this.mouseoutDiagram);
      this.diagramSelector = '';
    }
    if (!viewImageOther && !viewImageInEditor && !viewImageInCPB && !viewImageWithLink && !this.settings.viewDiagramInEditor) {
      return;
    }
    let selector = ``;
    if (viewImageInEditor) {
      selector += (viewImageWithLink ? VIEW_IMG_SELECTOR.EDITOR_AREAS : VIEW_IMG_SELECTOR.EDITOR_AREAS_NO_LINK);
    }
    if (viewImageInCPB) {
      selector += (1 < selector.length ? `,` : ``) + (viewImageWithLink ? VIEW_IMG_SELECTOR.CPB : VIEW_IMG_SELECTOR.CPB_NO_LINK);
    }
    if (viewImageOther) {
      selector += (1 < selector.length ? `,` : ``) + (viewImageWithLink ? VIEW_IMG_SELECTOR.OTHER : VIEW_IMG_SELECTOR.OTHER_NO_LINK);
    }

    if (selector) {
      this.imgSelector = selector;
      // doc.onclick = (event: MouseEvent) =>{
      //     console.log(event.target);
      // }
      doc.on('click', this.imgSelector, this.clickImage);
      doc.on('mouseover', this.imgSelector, this.mouseoverImg);
      doc.on('mouseout', this.imgSelector, this.mouseoutImg);
    }

    if (viewImageInEditor && this.settings.viewDiagramInEditor) {
      this.diagramSelector = VIEW_DIAGRAM_SELECTOR.EDITOR_AREAS;
      doc.addEventListener('click', this.clickDiagram, true);
      doc.on('mouseover', this.diagramSelector, this.mouseoverDiagram);
      doc.on('mouseout', this.diagramSelector, this.mouseoutDiagram);
    }
  }

  private clickImage = (event: MouseEvent) => {
    const targetEl = <HTMLImageElement>event.target;
    let container: ContainerView = this.isClickable(targetEl, event);
    if (container) {
      container.renderContainer(targetEl);
    }
  }

  private mouseoverImg = (event: MouseEvent) => {
    const targetEl = (<HTMLImageElement>event.target);
    if (!this.isClickable(targetEl, event)) {
      return;
    }
    if (null == targetEl.getAttribute(ImageToolkitPlugin.IMG_ORIGIN_CURSOR)) {
      targetEl.setAttribute(ImageToolkitPlugin.IMG_ORIGIN_CURSOR, targetEl.style.cursor || '');
    }
    targetEl.style.cursor = 'zoom-in';
  }

  private mouseoutImg = (event: MouseEvent) => {
    const targetEl = (<HTMLImageElement>event.target);
    if (!this.isClickable(targetEl, event)) {
      return;
    }
    targetEl.style.cursor = targetEl.getAttribute(ImageToolkitPlugin.IMG_ORIGIN_CURSOR);
  }

  private clickDiagram = (event: MouseEvent) => {
    if (this.isDiagramControlClick(event.target as HTMLElement)) return;

    const targetEl = this.getClosestDiagramElement(event.target as HTMLElement);
    const container: ContainerView = this.isClickableDiagram(targetEl, event);
    if (!container) return;

    const source = DiagramUtil.createImageSource(targetEl);
    if (!source) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    container.renderDiagramContainer(targetEl, source.src, source.alt, source.objectUrl);
  }

  private mouseoverDiagram = (event: MouseEvent) => {
    const targetEl = this.getClosestDiagramElement(event.target as HTMLElement);
    if (!this.isClickableDiagram(targetEl, event)) return;
    if (null == targetEl.getAttribute(ImageToolkitPlugin.IMG_ORIGIN_CURSOR)) {
      targetEl.setAttribute(ImageToolkitPlugin.IMG_ORIGIN_CURSOR, targetEl.style.cursor || '');
    }
    targetEl.style.cursor = 'zoom-in';
  }

  private mouseoutDiagram = (event: MouseEvent) => {
    const targetEl = this.getClosestDiagramElement(event.target as HTMLElement);
    if (!this.isClickableDiagram(targetEl, event)) return;
    targetEl.style.cursor = targetEl.getAttribute(ImageToolkitPlugin.IMG_ORIGIN_CURSOR);
  }

  private getClosestDiagramElement = (targetEl: HTMLElement): HTMLElement => {
    if (!targetEl || !this.diagramSelector) return null;
    return targetEl.closest(this.diagramSelector) as HTMLElement;
  }

  private isDiagramControlClick = (targetEl: HTMLElement): boolean => {
    return !!targetEl?.closest('.Preview__Recompile');
  }

  private isInsideDiagram = (targetEl: HTMLElement): boolean => {
    return !!this.getClosestDiagramElement(targetEl);
  }

}
