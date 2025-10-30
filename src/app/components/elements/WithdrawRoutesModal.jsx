
import React from 'react';
import ReactModal from 'react-modal';
import CloseButton from 'app/components/elements/CloseButton';
import tt from 'counterpart';
import WithdrawRoutesTable from 'app/components/elements/WithdrawRoutesTable';

ReactModal.defaultStyles.overlay.backgroundColor = 'rgba(0, 0, 0, 0.6)';

class WithdrawRoutesModal extends React.Component {
    render() {
        const { isOpen, onClose, routes, accountName, steemPower } = this.props;

        return (
            <ReactModal
                isOpen={isOpen}
                onRequestClose={onClose}
                className="ContainerModal__content"
                ariaHideApp={false}
            >
                <CloseButton onClick={onClose} />
                <div className="withdraw-routes-modal__container">
                    <h3>{tt('advanced_routes.current_withdraw_route')}</h3>
                    {routes.length === 0 ? (
                        <p>{tt('userwallet_jsx.no_withdraw_routes')}</p>
                    ) : (
                        <WithdrawRoutesTable
                            routes={routes}
                            accountName={accountName}
                            steemPower={steemPower}
                        />
                    )}
                </div>
            </ReactModal>
        );
    }
}

export default WithdrawRoutesModal;
