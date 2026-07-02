export interface DiagramImageSource {
  src: string;
  alt: string;
  objectUrl?: string;
}

export class DiagramUtil {

  public static createImageSource = (targetEl: HTMLElement): DiagramImageSource => {
    const coreEl = DiagramUtil.getCoreElement(targetEl);
    if (!coreEl) return null;

    const tagName = DiagramUtil.getTagName(coreEl);
    if ('img' === tagName) {
      const imgEl = coreEl as HTMLImageElement;
      if (!imgEl.src) return null;
      return {
        src: imgEl.src,
        alt: DiagramUtil.getAlt(targetEl, imgEl.alt)
      };
    }

    if ('svg' === tagName) {
      return DiagramUtil.createSvgImageSource(targetEl, coreEl as unknown as SVGSVGElement);
    }

    return null;
  }

  private static getCoreElement = (targetEl: HTMLElement): Element => {
    if (!targetEl) return null;
    const tagName = DiagramUtil.getTagName(targetEl);
    if ('img' === tagName || 'svg' === tagName) {
      return targetEl;
    }
    return targetEl.querySelector('svg,img') as HTMLElement;
  }

  private static getTagName = (el: Element): string => {
    return el?.tagName?.toLowerCase();
  }

  private static createSvgImageSource = (targetEl: HTMLElement, svgEl: SVGSVGElement): DiagramImageSource => {
    const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
    DiagramUtil.ensureSvgSize(clonedSvg, svgEl);
    DiagramUtil.ensureSvgBackground(clonedSvg, targetEl);
    if (!clonedSvg.getAttribute('xmlns')) {
      clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }

    const svgText = new XMLSerializer().serializeToString(clonedSvg);
    const blob = new Blob([svgText], {type: 'image/svg+xml;charset=utf-8'});
    const objectUrl = URL.createObjectURL(blob);
    return {
      src: objectUrl,
      alt: DiagramUtil.getAlt(targetEl),
      objectUrl
    };
  }

  private static ensureSvgSize = (clonedSvg: SVGSVGElement, sourceSvg: SVGSVGElement) => {
    const rect = sourceSvg.getBoundingClientRect();
    let width = DiagramUtil.parsePositiveNumber(clonedSvg.getAttribute('width'));
    let height = DiagramUtil.parsePositiveNumber(clonedSvg.getAttribute('height'));

    if ((!width || !height) && clonedSvg.viewBox?.baseVal) {
      const viewBox = clonedSvg.viewBox.baseVal;
      width = width || viewBox.width;
      height = height || viewBox.height;
    }

    width = width || rect.width;
    height = height || rect.height;

    if (width) clonedSvg.setAttribute('width', width + 'px');
    if (height) clonedSvg.setAttribute('height', height + 'px');
  }

  private static ensureSvgBackground = (clonedSvg: SVGSVGElement, targetEl: HTMLElement) => {
    if (!DiagramUtil.shouldUseWhiteBackground(targetEl)) return;

    const backgroundEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const viewBox = clonedSvg.viewBox?.baseVal;
    if (viewBox?.width && viewBox?.height) {
      backgroundEl.setAttribute('x', String(viewBox.x));
      backgroundEl.setAttribute('y', String(viewBox.y));
      backgroundEl.setAttribute('width', String(viewBox.width));
      backgroundEl.setAttribute('height', String(viewBox.height));
    } else {
      backgroundEl.setAttribute('x', '0');
      backgroundEl.setAttribute('y', '0');
      backgroundEl.setAttribute('width', '100%');
      backgroundEl.setAttribute('height', '100%');
    }
    backgroundEl.setAttribute('fill', '#fff');
    clonedSvg.insertBefore(backgroundEl, clonedSvg.firstChild);
  }

  private static shouldUseWhiteBackground = (targetEl: HTMLElement): boolean => {
    return !!targetEl?.hasClass('mermaid');
  }

  private static parsePositiveNumber = (value: string): number => {
    if (!value) return 0;
    if (value.indexOf('%') >= 0) return 0;
    const parsed = parseFloat(value);
    return parsed > 0 ? parsed : 0;
  }

  private static getAlt = (targetEl: HTMLElement, fallback?: string): string => {
    if (fallback) return fallback;
    if (!targetEl) return 'Diagram';
    if (targetEl.hasClass('mermaid')) return 'Mermaid diagram';
    if (targetEl.hasClass('block-language-plantuml') || targetEl.hasClass('block-language-plantuml-svg')) return 'PlantUML diagram';
    if (targetEl.hasClass('block-language-d2') || targetEl.hasClass('d2-chart')) return 'D2 diagram';
    return targetEl.getAttribute('aria-label') || targetEl.getAttribute('title') || 'Diagram';
  }

}
