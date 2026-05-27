import React from 'react';
import PropTypes from 'prop-types';
import tt from 'counterpart';

const ConfirmCreateWitness = ({ operation }) => {
    const {
        owner,
        url,
        new_signing_key,
        account_creation_fee,
        maximum_block_size,
        sbd_interest_rate,
        mode,
    } = operation;

    const modeLabel =
        mode === 'update'
            ? tt('steem_tools.create_witness.confirm_mode_update')
            : tt('steem_tools.create_witness.confirm_mode_create');

    return (
        <div className="info">
            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.create_witness.witness_account')}
                </span>
                <input className="input-group-field" type="text" value={`@${owner}`} disabled={true} />
            </div>

            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.create_witness.confirm_mode')}
                </span>
                <input className="input-group-field" type="text" value={modeLabel} disabled={true} />
            </div>

            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.create_witness.block_signing_key')}
                </span>
                <input className="input-group-field" type="text" value={new_signing_key} disabled={true} />
            </div>

            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.create_witness.witness_url')}
                </span>
                <input className="input-group-field" type="text" value={url} disabled={true} />
            </div>

            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.create_witness.account_creation_fee')}
                </span>
                <input className="input-group-field" type="text" value={account_creation_fee} disabled={true} />
            </div>

            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.create_witness.maximum_block_size')}
                </span>
                <input className="input-group-field" type="text" value={String(maximum_block_size)} disabled={true} />
            </div>

            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.create_witness.sbd_interest_rate')}
                </span>
                <input className="input-group-field" type="text" value={String(sbd_interest_rate)} disabled={true} />
            </div>
        </div>
    );
};

ConfirmCreateWitness.propTypes = {
    operation: PropTypes.shape({
        owner: PropTypes.string.isRequired,
        url: PropTypes.string.isRequired,
        new_signing_key: PropTypes.string.isRequired,
        account_creation_fee: PropTypes.string.isRequired,
        maximum_block_size: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
        sbd_interest_rate: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
        mode: PropTypes.oneOf(['create', 'update']).isRequired,
    }).isRequired,
};

export default ConfirmCreateWitness;
