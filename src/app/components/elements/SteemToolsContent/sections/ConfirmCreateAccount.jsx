import React from 'react';
import PropTypes from 'prop-types';
import tt from 'counterpart';

var ConfirmCreateAccount = function(props) {
    var operation = props.operation;
    var creator = operation.creator;
    var newAccount = operation.newAccount;
    var paymentMode = operation.paymentMode;
    var fee = operation.fee;

    var paymentLabel = paymentMode === 'TOKEN'
        ? tt('steem_tools.create_account.confirm_payment_act')
        : tt('steem_tools.create_account.confirm_payment_steem', { fee: fee });

    return (
        <div className="info">
            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.create_account.confirm_creator')}
                </span>
                <input className="input-group-field" type="text" value={'@' + creator} disabled={true} />
            </div>

            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.create_account.confirm_new_account')}
                </span>
                <input className="input-group-field" type="text" value={'@' + newAccount} disabled={true} />
            </div>

            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.create_account.confirm_payment')}
                </span>
                <input className="input-group-field" type="text" value={paymentLabel} disabled={true} />
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
                {tt('steem_tools.create_account.confirm_note')}
            </div>
        </div>
    );
};

ConfirmCreateAccount.propTypes = {
    operation: PropTypes.shape({
        creator: PropTypes.string.isRequired,
        newAccount: PropTypes.string.isRequired,
        paymentMode: PropTypes.oneOf(['TOKEN', 'STEEM']).isRequired,
        fee: PropTypes.string,
    }).isRequired,
};

export default ConfirmCreateAccount;
