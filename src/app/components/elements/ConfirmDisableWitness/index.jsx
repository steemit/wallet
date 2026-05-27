import React from 'react';
import PropTypes from 'prop-types';
import tt from 'counterpart';

const ConfirmDisableWitness = ({ operation }) => {
    const { owner, current_signing_key, new_signing_key } = operation;

    return (
        <div className="info">
            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.disable_witness.witness_account')}
                </span>
                <input className="input-group-field" type="text" value={`@${owner}`} disabled={true} />
            </div>

            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.disable_witness.current_signing_key')}
                </span>
                <input className="input-group-field" type="text" value={current_signing_key || ''} disabled={true} />
            </div>

            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.disable_witness.null_signing_key')}
                </span>
                <input className="input-group-field" type="text" value={new_signing_key} disabled={true} />
            </div>
        </div>
    );
};

ConfirmDisableWitness.propTypes = {
    operation: PropTypes.shape({
        owner: PropTypes.string.isRequired,
        current_signing_key: PropTypes.string,
        new_signing_key: PropTypes.string.isRequired,
    }).isRequired,
};

export default ConfirmDisableWitness;