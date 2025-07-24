import React from 'react';
import PropTypes from 'prop-types';
import tt from 'counterpart';

const ConfirmChangeRecoveryAccount = ({ operation }) => {
    const info = Object.keys(operation).map((k, i) => {
        return (
            <div key={`change-recovery-group-${i}`} className="input-group">
                <span
                    key={`change-recovery-label-${i}`}
                    className="input-group-label"
                >
                    {tt(`change_recovery_account.${k}`)}
                </span>
                <input
                    className="input-group-field"
                    type="text"
                    required
                    value={operation[k]}
                    disabled={true}
                    key={`change-recovery-input-${i}`}
                />
            </div>
        );
    });
    return <div className="info">{info}</div>;
};

ConfirmChangeRecoveryAccount.propTypes = {
    operation: PropTypes.shape({
        account_to_recover: PropTypes.string,
        new_recovery_account: PropTypes.string,
    }).isRequired,
};

export default ConfirmChangeRecoveryAccount;
