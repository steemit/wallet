import React from 'react';
import PropTypes from 'prop-types';
import tt from 'counterpart';

const LABELS = {
    action: () =>
        tt('steem_tools.authority_management.confirm_action', {
            fallback: 'Action',
        }),
    account: () =>
        tt('steem_tools.authority_management.account_to_modify', {
            fallback: 'Account',
        }),
    authority_type: () =>
        tt('steem_tools.authority_management.authority_type', {
            fallback: 'Authority Type',
        }),
    target_account: () =>
        tt('steem_tools.authority_management.add_account_authority', {
            fallback: 'Account Authority',
        }),
    weight: () =>
        tt('steem_tools.authority_management.weight', {
            fallback: 'Weight',
        }),
    weight_threshold: () =>
        tt('steem_tools.authority_management.weight_threshold', {
            fallback: 'Weight Threshold',
        }),
};

const ConfirmAuthorityManagement = ({ operation }) => {
    const fields = Object.keys(operation).filter((key) => {
        const value = operation[key];
        return value !== undefined && value !== null && value !== '';
    });

    return (
        <div className="info">
            {fields.map((key, index) => (
                <div
                    key={`authority-management-group-${index}`}
                    className="input-group"
                >
                    <span
                        className="input-group-label"
                        key={`authority-management-label-${index}`}
                    >
                        {LABELS[key] ? LABELS[key]() : key}
                    </span>
                    <input
                        className="input-group-field"
                        type="text"
                        required
                        value={String(operation[key])}
                        disabled={true}
                        key={`authority-management-input-${index}`}
                    />
                </div>
            ))}
        </div>
    );
};

ConfirmAuthorityManagement.propTypes = {
    operation: PropTypes.shape({
        action: PropTypes.string,
        account: PropTypes.string,
        authority_type: PropTypes.string,
        target_account: PropTypes.string,
        weight: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        weight_threshold: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    }).isRequired,
};

export default ConfirmAuthorityManagement;
