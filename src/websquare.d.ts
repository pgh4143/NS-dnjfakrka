export {};

declare global {
  interface WebSquareComponent {
    setValue?: (value: string) => void;
    getValue?: () => string;
    setSelectedIndex?: (index: number) => void;
    getAllJSON?: () => unknown;
    getJSON?: () => unknown;
    getRowCount?: () => number;
    getCellData?: (rowIndex: number, columnId: string) => unknown;
  }

  interface WebSquareRuntime {
    getComponentById: (id: string) => WebSquareComponent | null | undefined;
  }

  interface WebSquareHeaderScwin {
    openMenu: (
      menuName: string,
      menuUrl: string,
      menuCode: string,
      menuNum: string
    ) => void;
  }

  interface Window {
    $w: WebSquareRuntime;
    mf_wfm_header_scwin?: WebSquareHeaderScwin;
    chrome?: { runtime?: unknown };
  }
}
