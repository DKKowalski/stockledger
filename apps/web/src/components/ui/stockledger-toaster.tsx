import { CircleAlert, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { Toaster } from 'sonner';
import { SuccessMark } from '../animated-icons';

export function StockLedgerToaster() {
  return <Toaster
    className="stockledger-toaster"
    closeButton
    duration={3600}
    expand
    gap={10}
    icons={{
      success: <SuccessMark className="stockledger-toast-success" size={30} />,
      error: <CircleAlert className="stockledger-toast-error" size={25} />,
      warning: <TriangleAlert className="stockledger-toast-warning" size={25} />,
      info: <Info className="stockledger-toast-info" size={25} />,
      loading: <LoaderCircle className="stockledger-toast-loading" size={23} />,
      close: <X size={14} />,
    }}
    mobileOffset={{ bottom: 16, left: 16, right: 16 }}
    offset={{ bottom: 24, right: 24 }}
    position="bottom-right"
    swipeDirections={['right', 'bottom']}
    toastOptions={{
      closeButtonAriaLabel: 'Dismiss notification',
      classNames: {
        toast: 'stockledger-toast',
        content: 'stockledger-toast-content',
        title: 'stockledger-toast-title',
        description: 'stockledger-toast-description',
        icon: 'stockledger-toast-icon',
        closeButton: 'stockledger-toast-close',
      },
    }}
    visibleToasts={4}
  />;
}
