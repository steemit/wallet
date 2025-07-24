import React from 'react';
import ReactModal from 'react-modal';
import CloseButton from 'app/components/elements/CloseButton';

ReactModal.defaultStyles.overlay.backgroundColor = 'rgba(0, 0, 0, 0.6)';

const ConversionsModal = ({ isOpen, onClose, combinedConversions }) => {
    return (
        <ReactModal
            isOpen={isOpen}
            onRequestClose={onClose}
            className="VotersModal__content"
            ariaHideApp={false}
        >
            <CloseButton onClick={onClose} />
            <div className="conversions-modal__container">
                <h3>Conversions</h3>
                {combinedConversions.length === 0 ? (
                    <p>No conversion data available.</p>
                ) : (
                    <table className="conversions-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Request ID</th>
                                <th>Amount</th>
                                <th>Date</th>
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
