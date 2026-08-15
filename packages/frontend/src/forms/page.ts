export function page(
    name: string,
    callback: () => void,
): void {
    if (document.documentElement.dataset.page !== name) {
        return;
    }
    console.log('Current page:', document.documentElement.dataset.page)

    callback();
}