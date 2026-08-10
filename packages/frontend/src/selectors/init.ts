export function $<T extends Element = HTMLElement>(
    selector: string,
    root: ParentNode = document,
): T | null {
    return root.querySelector<T>(selector);
}

export function $$<T extends Element = HTMLElement>(
    selector: string,
    root: ParentNode = document,
): NodeListOf<T> {
    return root.querySelectorAll<T>(selector);
}