import React from 'react';
import ReactModal from 'react-modal';
import CloseButton from 'app/components/elements/CloseButton';
import tt from 'counterpart';

ReactModal.defaultStyles.overlay.backgroundColor = 'rgba(0, 0, 0, 0.6)';

const ConversionsModal = ({ isOpen, onClose, combinedConversions }) => {
    return (
        <ReactModal
            isOpen={isOpen}
            onRequestClose={onClose}
            className="ContainerModal__content"
            ariaHideApp={false}
        >
            <CloseButton onClick={onClose} />
            <div className="conversions-modal__container">
                <h3>{tt('converttosteem_jsx.current_conversions')}</h3>
                {combinedConversions.length === 0 ? (
                    <p>{tt('converttosteem_jsx.no_conversion_data')}</p>
                ) : (
                    <table className="conversions-table">
                        <thead>
                            <tr>
                                <th>{tt('converttosteem_jsx.id')}</th>
                                <th>{tt('converttosteem_jsx.request_id')}</th>
                                <th>{tt('g.amount')}</th>
                                <th>{tt('g.date')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {combinedConversions.map((item) => (
                                <tr key={item.id}>
                                    <td>{item.id}</td>
                                    <td>{item.requestid}</td>
                                    <td>${item.amount.toFixed(3)}</td>
                                    <td>{item.date.toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </ReactModal>
    );
};

export default ConversionsModal;
